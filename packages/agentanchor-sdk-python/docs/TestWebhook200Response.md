# TestWebhook200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **bool** |  | [optional] 
**status_code** | **int** |  | [optional] 
**response_time_ms** | **int** |  | [optional] 

## Example

```python
from agentanchor.models.test_webhook200_response import TestWebhook200Response

# TODO update the JSON string below
json = "{}"
# create an instance of TestWebhook200Response from a JSON string
test_webhook200_response_instance = TestWebhook200Response.from_json(json)
# print the JSON string representation of the object
print(TestWebhook200Response.to_json())

# convert the object into a dict
test_webhook200_response_dict = test_webhook200_response_instance.to_dict()
# create an instance of TestWebhook200Response from a dict
test_webhook200_response_from_dict = TestWebhook200Response.from_dict(test_webhook200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


