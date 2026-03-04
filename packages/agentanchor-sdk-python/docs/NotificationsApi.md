# agentanchor.NotificationsApi

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**list_notifications**](NotificationsApi.md#list_notifications) | **GET** /notifications | List notifications
[**mark_notifications_read**](NotificationsApi.md#mark_notifications_read) | **PATCH** /notifications | Mark notifications read


# **list_notifications**
> ListNotifications200Response list_notifications(unread_only=unread_only, limit=limit)

List notifications

Get notifications for the authenticated user.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.list_notifications200_response import ListNotifications200Response
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.NotificationsApi(api_client)
    unread_only = True # bool |  (optional)
    limit = 50 # int |  (optional) (default to 50)

    try:
        # List notifications
        api_response = api_instance.list_notifications(unread_only=unread_only, limit=limit)
        print("The response of NotificationsApi->list_notifications:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling NotificationsApi->list_notifications: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **unread_only** | **bool**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]

### Return type

[**ListNotifications200Response**](ListNotifications200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of notifications |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **mark_notifications_read**
> mark_notifications_read(mark_notifications_read_request=mark_notifications_read_request)

Mark notifications read

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.mark_notifications_read_request import MarkNotificationsReadRequest
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.NotificationsApi(api_client)
    mark_notifications_read_request = agentanchor.MarkNotificationsReadRequest() # MarkNotificationsReadRequest |  (optional)

    try:
        # Mark notifications read
        api_instance.mark_notifications_read(mark_notifications_read_request=mark_notifications_read_request)
    except Exception as e:
        print("Exception when calling NotificationsApi->mark_notifications_read: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **mark_notifications_read_request** | [**MarkNotificationsReadRequest**](MarkNotificationsReadRequest.md)|  | [optional] 

### Return type

void (empty response body)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Notifications updated |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

