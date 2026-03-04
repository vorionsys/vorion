# agentanchor.ObserverApi

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**list_anomalies**](ObserverApi.md#list_anomalies) | **GET** /observer/anomalies | List anomalies
[**query_observer_events**](ObserverApi.md#query_observer_events) | **GET** /observer/events | Query events


# **list_anomalies**
> ListAnomalies200Response list_anomalies(agent_id=agent_id, status=status)

List anomalies

List detected anomalies and behavioral deviations.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.list_anomalies200_response import ListAnomalies200Response
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
    api_instance = agentanchor.ObserverApi(api_client)
    agent_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    status = 'status_example' # str |  (optional)

    try:
        # List anomalies
        api_response = api_instance.list_anomalies(agent_id=agent_id, status=status)
        print("The response of ObserverApi->list_anomalies:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ObserverApi->list_anomalies: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **agent_id** | **UUID**|  | [optional] 
 **status** | **str**|  | [optional] 

### Return type

[**ListAnomalies200Response**](ListAnomalies200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of anomalies |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **query_observer_events**
> QueryObserverEvents200Response query_observer_events(agent_id=agent_id, event_type=event_type, severity=severity, since=since, limit=limit)

Query events

Query the append-only observer event log.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.query_observer_events200_response import QueryObserverEvents200Response
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
    api_instance = agentanchor.ObserverApi(api_client)
    agent_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    event_type = 'event_type_example' # str |  (optional)
    severity = 'severity_example' # str |  (optional)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    limit = 100 # int |  (optional) (default to 100)

    try:
        # Query events
        api_response = api_instance.query_observer_events(agent_id=agent_id, event_type=event_type, severity=severity, since=since, limit=limit)
        print("The response of ObserverApi->query_observer_events:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ObserverApi->query_observer_events: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **agent_id** | **UUID**|  | [optional] 
 **event_type** | **str**|  | [optional] 
 **severity** | **str**|  | [optional] 
 **since** | **datetime**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 100]

### Return type

[**QueryObserverEvents200Response**](QueryObserverEvents200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of observer events |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

